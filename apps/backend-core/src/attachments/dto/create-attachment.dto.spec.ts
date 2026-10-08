import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { CreateAttachmentDto } from './create-attachment.dto.js';

const PNG_HEADER = 'iVBORw0KGgo'; // یک sniplet معتبر base64 — محتوایش برای اعتبارسنجی مهم نیست، فقط الگوی data URI

async function errorsFor(fileUrl: unknown) {
  const dto = plainToInstance(CreateAttachmentDto, { entityType: 'Report', entityId: 'r-1', title: 'قرارداد.pdf', fileUrl });
  const errors = await validate(dto);
  return errors.filter((e) => e.property === 'fileUrl');
}

describe('CreateAttachmentDto — fileUrl (آپلود فایل واقعی یا لینک خارجی)', () => {
  it('accepts a real uploaded file as a base64 data URI', async () => {
    expect(await errorsFor(`data:application/pdf;base64,${PNG_HEADER}`)).toHaveLength(0);
  });

  it('accepts an ordinary external http(s) link', async () => {
    expect(await errorsFor('https://drive.google.com/file/d/abc')).toHaveLength(0);
  });

  it('rejects a data URI larger than the size cap so an oversized upload fails clearly instead of blowing up the request body', async () => {
    const huge = `data:application/pdf;base64,${'A'.repeat(15_000_001)}`;
    const errors = await errorsFor(huge);
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints?.isFileUrlOrDataUri).toContain('۱۵ مگابایت');
  });

  it('rejects active-content data URIs (HTML/SVG/JS) so a stored attachment can never execute script', async () => {
    for (const mime of ['text/html', 'image/svg+xml', 'application/javascript', 'application/xhtml+xml', 'text/xml']) {
      expect(await errorsFor(`data:${mime};base64,${PNG_HEADER}`), mime).toHaveLength(1);
    }
  });

  it('rejects garbage that is neither a data URI nor a URL', async () => {
    expect(await errorsFor('not a link at all')).toHaveLength(1);
  });

  it('rejects an empty value', async () => {
    expect(await errorsFor('')).toHaveLength(1);
  });
});
