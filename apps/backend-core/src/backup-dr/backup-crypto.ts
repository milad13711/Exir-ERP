import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { Transform, type TransformCallback } from 'node:stream';

/**
 * Streaming authenticated encryption for backup files ("EXBK" format v1).
 *
 *   header  : "EXBK"(4) | version(1) | chunkSizeLog2(1) | keyId(4) | salt(16)      = 26 bytes
 *   frame*  : flag(1; 0=data, 1=final) | ctLen(u32 BE) | ciphertext+tag(16)
 *
 * - fileKey = HKDF-SHA256(masterKey, salt, "exir-backup/v1/file-key"): a unique AES-256
 *   key per file, so (key, nonce) pairs can never repeat across files.
 * - nonce   = 4 zero bytes || frameIndex(u64 BE); unique per frame within a file.
 * - AAD     = header || frameIndex(u64) || flag: binds every frame to its file and
 *   position, so reordering, dropping, duplicating or splicing frames from another
 *   file fails authentication. The "final" flag is authenticated, so truncation
 *   (a missing final frame) is detected, as is trailing garbage after it.
 * - keyId   = first 4 bytes of sha256("exir-backup-keyid" || key): lets decrypt say
 *   "wrong key" instead of a vague auth failure. It leaks nothing useful.
 *
 * scripts/backup-decrypt.mjs is a standalone re-implementation of the reader —
 * keep the two in sync when bumping the version.
 */
export const MAGIC = Buffer.from('EXBK', 'ascii');
export const FORMAT_VERSION = 1;
export const DEFAULT_CHUNK_LOG2 = 18; // 256 KiB plaintext per frame
export const HEADER_LEN = 26;
const SALT_LEN = 16;
const TAG_LEN = 16;
const INFO = Buffer.from('exir-backup/v1/file-key', 'ascii');

export class BackupCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupCryptoError';
  }
}

/** Parses a 32-byte master key given as 64 hex chars or base64. Throws on anything else. */
export function parseEncryptionKey(raw: string | undefined | null): Buffer {
  const value = (raw ?? '').trim();
  if (!value) throw new BackupCryptoError('BACKUP_ENCRYPTION_KEY تنظیم نشده است');
  let key: Buffer | null = null;
  if (/^[0-9a-fA-F]{64}$/.test(value)) key = Buffer.from(value, 'hex');
  else if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) {
    const b = Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (b.length === 32) key = b;
  }
  if (!key) throw new BackupCryptoError('BACKUP_ENCRYPTION_KEY باید ۳۲ بایت (۶۴ کاراکتر hex یا base64) باشد');
  return key;
}

export function keyFingerprint(key: Buffer): Buffer {
  return createHash('sha256').update('exir-backup-keyid').update(key).digest().subarray(0, 4);
}

function deriveFileKey(master: Buffer, salt: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', master, salt, INFO, 32));
}

function frameNonce(index: bigint): Buffer {
  const n = Buffer.alloc(12);
  n.writeBigUInt64BE(index, 4);
  return n;
}

function frameAad(header: Buffer, index: bigint, final: boolean): Buffer {
  const tail = Buffer.alloc(9);
  tail.writeBigUInt64BE(index, 0);
  tail[8] = final ? 1 : 0;
  return Buffer.concat([header, tail]);
}

export class EncryptStream extends Transform {
  private readonly header: Buffer;
  private readonly fileKey: Buffer;
  private readonly chunkSize: number;
  private pending: Buffer = Buffer.alloc(0);
  private index = 0n;
  private headerSent = false;

  constructor(masterKey: Buffer, opts: { chunkLog2?: number } = {}) {
    super();
    if (masterKey.length !== 32) throw new BackupCryptoError('کلید رمزنگاری باید ۳۲ بایت باشد');
    const chunkLog2 = opts.chunkLog2 ?? DEFAULT_CHUNK_LOG2;
    if (chunkLog2 < 10 || chunkLog2 > 24) throw new BackupCryptoError('chunkLog2 نامعتبر');
    this.chunkSize = 1 << chunkLog2;
    const salt = randomBytes(SALT_LEN);
    this.header = Buffer.concat([MAGIC, Buffer.from([FORMAT_VERSION, chunkLog2]), keyFingerprint(masterKey), salt]);
    this.fileKey = deriveFileKey(masterKey, salt);
  }

  private sealFrame(plain: Buffer, final: boolean): Buffer {
    const cipher = createCipheriv('aes-256-gcm', this.fileKey, frameNonce(this.index), { authTagLength: TAG_LEN });
    cipher.setAAD(frameAad(this.header, this.index, final));
    const ct = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
    this.index += 1n;
    const head = Buffer.alloc(5);
    head[0] = final ? 1 : 0;
    head.writeUInt32BE(ct.length, 1);
    return Buffer.concat([head, ct]);
  }

  private emitHeader() {
    if (!this.headerSent) {
      this.headerSent = true;
      this.push(this.header);
    }
  }

  _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback) {
    try {
      this.emitHeader();
      this.pending = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
      // A full chunk is only sealed once more data arrives, so the last frame can be marked final.
      while (this.pending.length > this.chunkSize) {
        this.push(this.sealFrame(this.pending.subarray(0, this.chunkSize), false));
        this.pending = this.pending.subarray(this.chunkSize);
      }
      cb();
    } catch (err) {
      cb(err as Error);
    }
  }

  _flush(cb: TransformCallback) {
    try {
      this.emitHeader();
      this.push(this.sealFrame(this.pending, true));
      this.pending = Buffer.alloc(0);
      cb();
    } catch (err) {
      cb(err as Error);
    }
  }
}

export class DecryptStream extends Transform {
  private buf: Buffer = Buffer.alloc(0);
  private header: Buffer | null = null;
  private fileKey: Buffer | null = null;
  private chunkSize = 0;
  private index = 0n;
  private sawFinal = false;

  constructor(private readonly masterKey: Buffer) {
    super();
    if (masterKey.length !== 32) throw new BackupCryptoError('کلید رمزنگاری باید ۳۲ بایت باشد');
  }

  private parseHeader(): boolean {
    if (this.buf.length < HEADER_LEN) return false;
    const header = this.buf.subarray(0, HEADER_LEN);
    if (!header.subarray(0, 4).equals(MAGIC)) throw new BackupCryptoError('این فایل بکاپ رمزنگاری‌شده‌ی اکسیر نیست (امضای EXBK یافت نشد)');
    if (header[4] !== FORMAT_VERSION) throw new BackupCryptoError(`نسخه‌ی فرمت بکاپ (${header[4]}) پشتیبانی نمی‌شود`);
    const log2 = header[5];
    if (log2 < 10 || log2 > 24) throw new BackupCryptoError('هدر بکاپ نامعتبر است');
    if (!header.subarray(6, 10).equals(keyFingerprint(this.masterKey))) {
      throw new BackupCryptoError('کلید رمزنگاری اشتباه است (با کلید این فایل مطابقت ندارد)');
    }
    this.header = Buffer.from(header);
    this.chunkSize = 1 << log2;
    this.fileKey = deriveFileKey(this.masterKey, header.subarray(10, 26));
    this.buf = this.buf.subarray(HEADER_LEN);
    return true;
  }

  private drain(): void {
    if (!this.header && !this.parseHeader()) return;
    for (;;) {
      if (this.sawFinal) {
        if (this.buf.length > 0) throw new BackupCryptoError('داده‌ی اضافه بعد از پایان فایل بکاپ — فایل دستکاری شده است');
        return;
      }
      if (this.buf.length < 5) return;
      const flag = this.buf[0];
      if (flag > 1) throw new BackupCryptoError('فریم نامعتبر در فایل بکاپ');
      const ctLen = this.buf.readUInt32BE(1);
      if (ctLen < TAG_LEN || ctLen > this.chunkSize + TAG_LEN) throw new BackupCryptoError('طول فریم نامعتبر است — فایل خراب یا دستکاری شده');
      if (this.buf.length < 5 + ctLen) return;
      const ct = this.buf.subarray(5, 5 + ctLen);
      const final = flag === 1;
      const decipher = createDecipheriv('aes-256-gcm', this.fileKey!, frameNonce(this.index), { authTagLength: TAG_LEN });
      decipher.setAAD(frameAad(this.header!, this.index, final));
      decipher.setAuthTag(ct.subarray(ctLen - TAG_LEN));
      let plain: Buffer;
      try {
        plain = Buffer.concat([decipher.update(ct.subarray(0, ctLen - TAG_LEN)), decipher.final()]);
      } catch {
        throw new BackupCryptoError(`احراز اصالت فریم ${this.index} ناموفق بود — فایل خراب یا دستکاری شده است`);
      }
      this.index += 1n;
      this.buf = this.buf.subarray(5 + ctLen);
      if (plain.length) this.push(plain);
      if (final) this.sawFinal = true;
    }
  }

  _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback) {
    try {
      this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
      this.drain();
      cb();
    } catch (err) {
      cb(err as Error);
    }
  }

  _flush(cb: TransformCallback) {
    if (!this.header) return cb(new BackupCryptoError('فایل بکاپ کوتاه‌تر از هدر است (ناقص)'));
    if (!this.sawFinal) return cb(new BackupCryptoError('فایل بکاپ ناقص است (فریم پایانی یافت نشد) — احتمالاً بریده شده'));
    cb();
  }
}

/** True when the file starts with the encrypted-backup magic (cheap sniff, no key needed). */
export function looksEncrypted(head: Buffer): boolean {
  return head.length >= 4 && head.subarray(0, 4).equals(MAGIC);
}
