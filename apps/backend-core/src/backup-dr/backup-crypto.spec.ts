import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { BackupCryptoError, DecryptStream, EncryptStream, HEADER_LEN, looksEncrypted, parseEncryptionKey } from './backup-crypto.js';

async function collect(source: Readable | AsyncIterable<Buffer>, ...transforms: any[]): Promise<Buffer> {
  const chunks: Buffer[] = [];
  await (pipeline as any)(source as Readable, ...transforms, async (src: AsyncIterable<Buffer>) => {
    for await (const c of src) chunks.push(Buffer.from(c));
  });
  return Buffer.concat(chunks);
}
const enc = (key: Buffer, data: Buffer, chunkLog2 = 12, piece = 1000) =>
  collect(Readable.from(splitBuf(data, piece)), new EncryptStream(key, { chunkLog2 }));
function* splitBuf(b: Buffer, n: number) {
  if (b.length === 0) { yield b; return; }
  for (let i = 0; i < b.length; i += n) yield b.subarray(i, i + n);
}
const dec = (key: Buffer, data: Buffer, piece = 777) => collect(Readable.from(splitBuf(data, piece)), new DecryptStream(key));

const key = randomBytes(32);

describe('backup crypto', () => {
  it('round-trips arbitrary sizes including empty and exact chunk multiples', async () => {
    for (const len of [0, 1, 4095, 4096, 4097, 8192, 100_000]) {
      const plain = randomBytes(len);
      const ct = await enc(key, plain);
      expect(looksEncrypted(ct)).toBe(true);
      expect((await dec(key, ct)).equals(plain)).toBe(true);
    }
  });

  it('produces different ciphertext each time (random salt) and does not contain plaintext', async () => {
    const plain = Buffer.from('SECRET-PASSWORD-HASH '.repeat(500));
    const a = await enc(key, plain);
    const b = await enc(key, plain);
    expect(a.equals(b)).toBe(false);
    expect(a.includes(Buffer.from('SECRET-PASSWORD'))).toBe(false);
  });

  it('detects a flipped byte in any region (header, frame header, ciphertext, tag)', async () => {
    const ct = await enc(key, randomBytes(20_000));
    for (const pos of [0, 5, 12, 20, HEADER_LEN, HEADER_LEN + 3, HEADER_LEN + 100, ct.length - 1, ct.length - 20]) {
      const bad = Buffer.from(ct);
      bad[pos] ^= 0x01;
      await expect(dec(key, bad)).rejects.toBeInstanceOf(BackupCryptoError);
    }
  });

  it('detects truncation at every boundary, including whole-frame truncation', async () => {
    const plain = randomBytes(20_000);
    const ct = await enc(key, plain);
    for (const cut of [0, 10, HEADER_LEN, HEADER_LEN + 5, ct.length - 1, ct.length - 17]) {
      await expect(dec(key, ct.subarray(0, cut))).rejects.toBeInstanceOf(BackupCryptoError);
    }
    // cut exactly at a frame boundary (frame = 5 + 4096 + 16)
    await expect(dec(key, ct.subarray(0, HEADER_LEN + 2 * (5 + 4096 + 16)))).rejects.toThrow(/ناقص|بریده/);
  });

  it('detects reordered / duplicated frames and trailing data', async () => {
    const ct = await enc(key, randomBytes(3 * 4096 + 10));
    const f = 5 + 4096 + 16;
    const head = ct.subarray(0, HEADER_LEN);
    const frames = [0, 1, 2, 3].map((i) => ct.subarray(HEADER_LEN + i * f, i === 3 ? undefined : HEADER_LEN + (i + 1) * f));
    await expect(dec(key, Buffer.concat([head, frames[1], frames[0], frames[2], frames[3]]))).rejects.toBeInstanceOf(BackupCryptoError);
    await expect(dec(key, Buffer.concat([head, frames[0], frames[0], frames[2], frames[3]]))).rejects.toBeInstanceOf(BackupCryptoError);
    await expect(dec(key, Buffer.concat([ct, Buffer.from([0])]))).rejects.toThrow(/اضافه/);
  });

  it('rejects the wrong key with a clear message, and non-backup input', async () => {
    const ct = await enc(key, Buffer.from('hello'));
    await expect(dec(randomBytes(32), ct)).rejects.toThrow(/کلید رمزنگاری اشتباه/);
    await expect(dec(key, Buffer.from('this is just a plain text file, definitely'))).rejects.toThrow(/EXBK/);
  });

  it('handles a large (48 MiB) stream with default chunk size', async () => {
    const piece = randomBytes(1 << 20);
    const gen = function* () { for (let i = 0; i < 48; i++) yield piece; };
    const ct = await collect(Readable.from(gen()), new EncryptStream(key));
    const out = await collect(Readable.from(splitBuf(ct, 1 << 16)), new DecryptStream(key));
    expect(out.length).toBe(48 << 20);
    expect(out.subarray(0, 1 << 20).equals(piece)).toBe(true);
    expect(out.subarray(47 << 20).equals(piece)).toBe(true);
  }, 60_000);

  it('parses hex and base64 keys, rejects bad ones', () => {
    const k = randomBytes(32);
    expect(parseEncryptionKey(k.toString('hex')).equals(k)).toBe(true);
    expect(parseEncryptionKey(k.toString('base64')).equals(k)).toBe(true);
    expect(() => parseEncryptionKey('')).toThrow();
    expect(() => parseEncryptionKey('abc')).toThrow();
    expect(() => parseEncryptionKey(randomBytes(16).toString('hex'))).toThrow();
  });

  it('standalone scripts/backup-decrypt.mjs reads what the app writes; fails on tamper / wrong key', async () => {
    const script = resolve(__dirname, '../../../../scripts/backup-decrypt.mjs');
    const dir = mkdtempSync(join(tmpdir(), 'exbk-'));
    const plain = randomBytes(50_000);
    const ct = await enc(key, plain, 14);
    const file = join(dir, 'a.enc');
    writeFileSync(file, ct);
    const out = execFileSync('node', [script, file], { env: { ...process.env, BACKUP_ENCRYPTION_KEY: key.toString('hex') }, maxBuffer: 1 << 26 });
    expect(Buffer.from(out).equals(plain)).toBe(true);

    const bad = Buffer.from(ct); bad[HEADER_LEN + 50] ^= 1;
    writeFileSync(join(dir, 'bad.enc'), bad);
    const r1 = spawnSync('node', [script, join(dir, 'bad.enc')], { env: { ...process.env, BACKUP_ENCRYPTION_KEY: key.toString('hex') } });
    expect(r1.status).not.toBe(0);
    const r2 = spawnSync('node', [script, '--verify', file], { env: { ...process.env, BACKUP_ENCRYPTION_KEY: randomBytes(32).toString('hex') } });
    expect(r2.status).not.toBe(0);
    const r3 = spawnSync('node', [script, '--verify', file], { env: { ...process.env, BACKUP_ENCRYPTION_KEY: key.toString('hex') } });
    expect(r3.status).toBe(0);
    writeFileSync(join(dir, 'trunc.enc'), ct.subarray(0, ct.length - 30));
    expect(spawnSync('node', [script, '--verify', join(dir, 'trunc.enc')], { env: { ...process.env, BACKUP_ENCRYPTION_KEY: key.toString('hex') } }).status).not.toBe(0);
  });
});
