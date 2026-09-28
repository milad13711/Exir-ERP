/**
 * Extracts pixel width/height from a base64 data-URL image (PNG or JPEG),
 * without any extra rendering round-trip — just enough header parsing to
 * know the aspect ratio so the certificate canvas/PDF page can match it.
 * Returns null for anything else (unsupported format, corrupt data, etc.);
 * callers should fall back to a sensible default aspect ratio.
 */
export function getDataUrlImageDimensions(dataUrl: string | null | undefined): { width: number; height: number } | null {
  if (!dataUrl) return null;
  const match = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(dataUrl.trim());
  if (!match) return null;
  try {
    const buf = Buffer.from(match[2], 'base64');
    if (/^png$/i.test(match[1])) return readPngDimensions(buf);
    return readJpegDimensions(buf);
  } catch {
    return null;
  }
}

function readPngDimensions(buf: Buffer): { width: number; height: number } | null {
  // 8-byte signature + 4-byte length + 4-byte "IHDR" then width(4) height(4), big-endian.
  if (buf.length < 24) return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (!width || !height) return null;
  return { width, height };
}

function readJpegDimensions(buf: Buffer): { width: number; height: number } | null {
  let offset = 2; // skip SOI marker (0xFFD8)
  while (offset < buf.length - 8) {
    if (buf[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buf[offset + 1];
    // SOF0..SOF15 markers (excluding DHT/JPG/DAC) carry frame dimensions.
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    const segmentLength = buf.readUInt16BE(offset + 2);
    if (isSof) {
      const height = buf.readUInt16BE(offset + 5);
      const width = buf.readUInt16BE(offset + 7);
      if (width && height) return { width, height };
      return null;
    }
    offset += 2 + segmentLength;
  }
  return null;
}
