import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { isHttpUrl } from './is-http-url.js';
import { CreateResellerApplicationDto } from '../../public/dto/create-reseller-application.dto.js';
import { CreateEventDto } from '../../events/dto/create-event.dto.js';

describe('isHttpUrl', () => {
  it('accepts http(s) URLs and empty', () => {
    for (const v of ['https://example.com', 'http://a.ir/x?y=1', '']) expect(isHttpUrl(v), v).toBe(true);
  });
  it('rejects script/data/file schemes, relative and junk', () => {
    for (const v of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html;base64,AAAA', 'file:///etc/passwd', 'vbscript:x', '//evil.com', 'example.com', 5, null, 'https://' + 'a'.repeat(600)]) {
      expect(isHttpUrl(v as never), String(v)).toBe(false);
    }
  });
});

describe('DTOs that surface a URL as a clickable link', () => {
  it('public reseller application rejects a javascript: websiteUrl (stored XSS in admin panel)', async () => {
    const bad = plainToInstance(CreateResellerApplicationDto, { name: 'x', phone: '09120000000', productCode: 'ERP', websiteUrl: 'javascript:fetch(1)' });
    const errors = await validate(bad);
    expect(errors.some((e) => e.property === 'websiteUrl')).toBe(true);
    const good = plainToInstance(CreateResellerApplicationDto, { name: 'x', phone: '09120000000', productCode: 'ERP', websiteUrl: 'https://shop.example.ir' });
    expect((await validate(good)).some((e) => e.property === 'websiteUrl')).toBe(false);
  });

  it('event onlineUrl rejects non-http schemes', async () => {
    const bad = plainToInstance(CreateEventDto, { onlineUrl: 'javascript:alert(1)' });
    expect((await validate(bad)).some((e) => e.property === 'onlineUrl')).toBe(true);
  });
});
