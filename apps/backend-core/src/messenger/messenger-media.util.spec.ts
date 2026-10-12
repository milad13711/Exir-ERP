import { describe, expect, it } from 'vitest';
import { MEDIA_LIMITS, MEDIA_TTL_MS, hoursUntilExpiry, isMediaExpired, kindForMime, looksExecutable, magicMatches, mediaExpiry, sanitizeFileName, selectExpiredMedia } from './messenger-media.util.js';

describe('messenger media rules', () => {
  it('limits follow the product rules (2/10/18 MB)', () => {
    expect(MEDIA_LIMITS).toEqual({ IMAGE: 2097152, FILE: 10485760, VIDEO: 18874368 });
  });

  it('classifies by allowlisted MIME and rejects the rest', () => {
    expect(kindForMime('image/png')).toBe('IMAGE');
    expect(kindForMime('video/mp4')).toBe('VIDEO');
    expect(kindForMime('application/pdf')).toBe('FILE');
    expect(kindForMime('image/svg+xml')).toBeNull();
    expect(kindForMime('text/html')).toBeNull();
    expect(kindForMime('application/x-msdownload')).toBeNull();
  });

  it('sniffs magic bytes', () => {
    expect(magicMatches('image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe(true);
    expect(magicMatches('image/png', Buffer.from('<html>'))).toBe(false);
    expect(magicMatches('image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(magicMatches('application/pdf', Buffer.from('%PDF-1.7'))).toBe(true);
    expect(magicMatches('video/mp4', Buffer.concat([Buffer.alloc(4), Buffer.from('ftypisom')]))).toBe(true);
  });

  it('refuses executables under any MIME', () => {
    expect(looksExecutable(Buffer.from('MZ\x90\x00'))).toBe(true);
    expect(magicMatches('text/plain', Buffer.from('MZ\x90\x00'))).toBe(false);
    expect(magicMatches('text/plain', Buffer.from('#!/bin/sh'))).toBe(false);
    expect(magicMatches('text/plain', Buffer.from('hello'))).toBe(true);
  });

  it('sanitizes file names', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('.._.._etc_passwd'.replace(/^\.+/, ''));
    expect(sanitizeFileName('a<b>:"c|?.pdf')).toBe('abc.pdf');
    expect(sanitizeFileName('', 'file')).toBe('file');
    const long = sanitizeFileName(`${'x'.repeat(300)}.pdf`);
    expect(long.length).toBeLessThanOrEqual(100);
    expect(long.endsWith('.pdf')).toBe(true);
  });
});

describe('media expiry', () => {
  const created = new Date('2026-10-12T10:00:00Z');
  it('expires exactly 24h after creation', () => {
    expect(mediaExpiry(created).getTime() - created.getTime()).toBe(MEDIA_TTL_MS);
  });

  it('purge selection: only expired and not yet purged', () => {
    const now = new Date('2026-10-13T10:00:00Z');
    const rows = [
      { id: 'fresh', expiresAt: new Date('2026-10-13T10:00:01Z'), purgedAt: null },
      { id: 'exact', expiresAt: new Date('2026-10-13T10:00:00Z'), purgedAt: null },
      { id: 'old', expiresAt: new Date('2026-10-12T00:00:00Z'), purgedAt: null },
      { id: 'done', expiresAt: new Date('2026-10-12T00:00:00Z'), purgedAt: new Date('2026-10-12T05:00:00Z') },
    ];
    expect(selectExpiredMedia(rows, now).map((r) => r.id)).toEqual(['exact', 'old']);
    expect(isMediaExpired(rows[3], now)).toBe(true);
    expect(isMediaExpired(rows[0], now)).toBe(false);
  });

  it('countdown rounds up and bottoms at 0 when expired', () => {
    const m = { expiresAt: new Date('2026-10-12T12:30:00Z'), purgedAt: null };
    expect(hoursUntilExpiry(m, new Date('2026-10-12T10:00:00Z'))).toBe(3);
    expect(hoursUntilExpiry(m, new Date('2026-10-12T12:29:00Z'))).toBe(1);
    expect(hoursUntilExpiry(m, new Date('2026-10-12T13:00:00Z'))).toBe(0);
  });
});
