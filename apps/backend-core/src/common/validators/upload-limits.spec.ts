import { plainToInstance } from 'class-transformer';
import { IsOptional } from 'class-validator';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { checkDataUri, IsUploadDataUri, UPLOAD_CAPS } from './upload-limits.js';

const b = (mime: string, n = 10) => `data:${mime};base64,${'A'.repeat(n)}`;

describe('checkDataUri', () => {
  it('accepts a small image and rejects an oversized one', () => {
    expect(checkDataUri(b('image/jpeg'), 'image')).toBeNull();
    expect(checkDataUri(b('image/jpeg', UPLOAD_CAPS.imageChars), 'image')).toContain('حجم تصویر');
  });
  it('uses the tighter cap for avatars/logos', () => {
    expect(checkDataUri(b('image/png', UPLOAD_CAPS.smallImageChars + 1), 'smallImage')).toContain('حجم');
    expect(checkDataUri(b('image/png', UPLOAD_CAPS.smallImageChars - 100), 'smallImage')).toBeNull();
  });
  it('rejects non-images and active content for image fields', () => {
    expect(checkDataUri(b('application/pdf'), 'image')).not.toBeNull();
    expect(checkDataUri(b('image/svg+xml'), 'image')).not.toBeNull();
    expect(checkDataUri(b('text/html'), 'file')).not.toBeNull();
  });
  it('applies file / video / image caps for generic files', () => {
    expect(checkDataUri(b('application/pdf', UPLOAD_CAPS.fileChars), 'file')).toContain('۱۰ مگابایت');
    expect(checkDataUri(b('video/mp4', UPLOAD_CAPS.fileChars + 1000), 'file')).toBeNull();
    expect(checkDataUri(b('video/mp4', UPLOAD_CAPS.videoChars + 1), 'file')).toContain('ویدئو');
    expect(checkDataUri(b('image/jpeg', UPLOAD_CAPS.imageChars + 1), 'file')).toContain('تصویر');
  });
  it('rejects unknown MIME and malformed URIs', () => {
    expect(checkDataUri(b('application/x-msdownload'), 'file')).toContain('پشتیبانی');
    expect(checkDataUri('data:image/png,abc', 'image')).toContain('نامعتبر');
  });
});

class Probe {
  @IsOptional()
  @IsUploadDataUri('smallImage', { allowHttp: true })
  logo?: string | null;
}
const errs = async (logo: unknown) => (await validate(plainToInstance(Probe, { logo }))).length;

describe('IsUploadDataUri decorator', () => {
  it('passes undefined, empty, small data URI and http link', async () => {
    expect(await errs(undefined)).toBe(0);
    expect(await errs('')).toBe(0);
    expect(await errs(b('image/webp'))).toBe(0);
    expect(await errs('https://example.com/a.png')).toBe(0);
  });
  it('fails oversize, wrong type, javascript: and non-strings', async () => {
    expect(await errs(b('image/webp', UPLOAD_CAPS.smallImageChars + 1))).toBe(1);
    expect(await errs(b('application/pdf'))).toBe(1);
    expect(await errs('javascript:alert(1)')).toBe(1);
    expect(await errs(123)).toBe(1);
  });
});
