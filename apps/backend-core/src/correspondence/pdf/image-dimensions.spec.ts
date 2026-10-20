import { describe, expect, it } from 'vitest';
import { dimensionsAcceptable, readJpegSize, readPngSize, readWebpSize } from './image-dimensions.js';
import { safeLetterImage } from './sanitize-letter-html.js';

const png = (w: number, h: number) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), Buffer.from('IHDR'), (() => { const b = Buffer.alloc(8); b.writeUInt32BE(w, 0); b.writeUInt32BE(h, 4); return b; })(), Buffer.alloc(20, 1)]);
const jpeg = (w: number, h: number) => {
  const sof = Buffer.alloc(19);
  sof.writeUInt16BE(0xffc0, 0); sof.writeUInt16BE(17, 2); sof[4] = 8; sof.writeUInt16BE(h, 5); sof.writeUInt16BE(w, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0]), sof, Buffer.alloc(20, 1)]);
};
const webpHead = (kind: string) => { const b = Buffer.alloc(40, 0); b.write('RIFF', 0, 'latin1'); b.write('WEBP', 8, 'latin1'); b.write(kind, 12, 'latin1'); return b; };
const uri = (type: string, b: Buffer) => `data:image/${type};base64,${b.toString('base64')}`;

describe('image dimensions', () => {
  it('reads PNG/JPEG/WebP sizes', () => {
    expect(readPngSize(png(640, 480))).toEqual({ w: 640, h: 480 });
    expect(readJpegSize(jpeg(1200, 800))).toEqual({ w: 1200, h: 800 });
    const vp8x = webpHead('VP8X'); vp8x.writeUIntLE(1999, 24, 3); vp8x.writeUIntLE(999, 27, 3);
    expect(readWebpSize(vp8x)).toEqual({ w: 2000, h: 1000 });
    const vp8l = webpHead('VP8L'); vp8l[20] = 0x2f; vp8l.writeUInt32LE((99) | (49 << 14), 21);
    expect(readWebpSize(vp8l)).toEqual({ w: 100, h: 50 });
    const vp8 = webpHead('VP8 '); vp8[23] = 0x9d; vp8[24] = 0x01; vp8[25] = 0x2a; vp8.writeUInt16LE(320, 26); vp8.writeUInt16LE(200, 28);
    expect(readWebpSize(vp8)).toEqual({ w: 320, h: 200 });
  });
  it('rejects oversized and pixel-bomb images, and unreadable headers', () => {
    expect(dimensionsAcceptable({ w: 8000, h: 3000 })).toBe(true);
    expect(dimensionsAcceptable({ w: 9000, h: 10 })).toBe(false);
    expect(dimensionsAcceptable({ w: 6000, h: 6000 })).toBe(false); // ۳۶ مگاپیکسل
    expect(dimensionsAcceptable(null)).toBe(false);
    expect(safeLetterImage(uri('png', png(1000, 1000)))).not.toBeNull();
    expect(safeLetterImage(uri('png', png(65000, 65000)))).toBeNull();
    expect(safeLetterImage(uri('png', png(7999, 3126)))).toBeNull(); // 25.003MP
    expect(safeLetterImage(uri('jpeg', jpeg(20000, 20000)))).toBeNull();
    expect(safeLetterImage(uri('jpeg', jpeg(800, 600)))).not.toBeNull();
  });
});
