#!/usr/bin/env node
// Standalone decryptor for Exir encrypted backups (format "EXBK" v1). No dependencies on app code.
//
//   BACKUP_ENCRYPTION_KEY=<64 hex | base64> node scripts/backup-decrypt.mjs 2026-10-08.sql.gz.enc | gunzip | psql <db>
//   node scripts/backup-decrypt.mjs --key-file /secure/backup.key file.enc > file.sql.gz
//   node scripts/backup-decrypt.mjs --verify file.enc        # authenticate every byte, print nothing
//
// The key is read from the BACKUP_ENCRYPTION_KEY env var or --key-file (never a CLI argument, so it
// does not show up in `ps`). Exit code 0 only if the WHOLE file authenticates (truncation / tampering
// / wrong key all exit non-zero). NOTE: when piped into gunzip|psql, psql may already have received
// the earlier part of the data when a late error is detected - always check the exit status of this
// script (use `set -o pipefail`), and restore into an empty database.
import { createDecipheriv, createHash, hkdfSync } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const MAGIC = Buffer.from('EXBK', 'ascii');
const HEADER_LEN = 26;
const TAG_LEN = 16;
const INFO = Buffer.from('exir-backup/v1/file-key', 'ascii');

function fail(msg, code = 1) {
  process.stderr.write(`backup-decrypt: ${msg}\n`);
  process.exit(code);
}

function parseKey(raw) {
  const v = (raw ?? '').trim();
  if (/^[0-9a-fA-F]{64}$/.test(v)) return Buffer.from(v, 'hex');
  if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(v)) {
    const b = Buffer.from(v.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (b.length === 32) return b;
  }
  return null;
}

const fingerprint = (key) => createHash('sha256').update('exir-backup-keyid').update(key).digest().subarray(0, 4);
const nonceFor = (i) => { const n = Buffer.alloc(12); n.writeBigUInt64BE(i, 4); return n; };
const aadFor = (header, i, final) => { const t = Buffer.alloc(9); t.writeBigUInt64BE(i, 0); t[8] = final ? 1 : 0; return Buffer.concat([header, t]); };

class Decrypt extends Transform {
  constructor(master) {
    super();
    this.master = master; this.buf = Buffer.alloc(0); this.header = null; this.fileKey = null;
    this.chunkSize = 0; this.index = 0n; this.sawFinal = false;
  }
  drain() {
    if (!this.header) {
      if (this.buf.length < HEADER_LEN) return;
      const h = this.buf.subarray(0, HEADER_LEN);
      if (!h.subarray(0, 4).equals(MAGIC)) throw new Error('not an Exir encrypted backup (missing EXBK magic)');
      if (h[4] !== 1) throw new Error(`unsupported backup format version ${h[4]}`);
      if (h[5] < 10 || h[5] > 24) throw new Error('invalid header');
      if (!h.subarray(6, 10).equals(fingerprint(this.master))) throw new Error('WRONG KEY: does not match the key this file was encrypted with');
      this.header = Buffer.from(h);
      this.chunkSize = 1 << h[5];
      this.fileKey = Buffer.from(hkdfSync('sha256', this.master, h.subarray(10, 26), INFO, 32));
      this.buf = this.buf.subarray(HEADER_LEN);
    }
    for (;;) {
      if (this.sawFinal) {
        if (this.buf.length) throw new Error('trailing data after the final frame - file was tampered with');
        return;
      }
      if (this.buf.length < 5) return;
      const flag = this.buf[0];
      if (flag > 1) throw new Error('invalid frame');
      const ctLen = this.buf.readUInt32BE(1);
      if (ctLen < TAG_LEN || ctLen > this.chunkSize + TAG_LEN) throw new Error('invalid frame length - file corrupt or tampered with');
      if (this.buf.length < 5 + ctLen) return;
      const ct = this.buf.subarray(5, 5 + ctLen);
      const final = flag === 1;
      const d = createDecipheriv('aes-256-gcm', this.fileKey, nonceFor(this.index), { authTagLength: TAG_LEN });
      d.setAAD(aadFor(this.header, this.index, final));
      d.setAuthTag(ct.subarray(ctLen - TAG_LEN));
      let plain;
      try { plain = Buffer.concat([d.update(ct.subarray(0, ctLen - TAG_LEN)), d.final()]); }
      catch { throw new Error(`authentication failed at frame ${this.index} - file corrupt or tampered with`); }
      this.index += 1n;
      this.buf = this.buf.subarray(5 + ctLen);
      if (plain.length && !this.verifyOnly) this.push(plain);
      if (final) this.sawFinal = true;
    }
  }
  _transform(chunk, _e, cb) {
    try { this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk; this.drain(); cb(); } catch (e) { cb(e); }
  }
  _flush(cb) {
    if (!this.header) return cb(new Error('file shorter than the header (incomplete)'));
    if (!this.sawFinal) return cb(new Error('file is incomplete (final frame missing) - truncated'));
    cb();
  }
}

const argv = process.argv.slice(2);
let keyFile = null, verifyOnly = false, file = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--key-file') keyFile = argv[++i];
  else if (argv[i] === '--verify') verifyOnly = true;
  else if (argv[i] === '-h' || argv[i] === '--help') fail('usage: [BACKUP_ENCRYPTION_KEY=...] backup-decrypt.mjs [--key-file F] [--verify] <file.enc>', 0);
  else if (!file) file = argv[i];
  else fail('unexpected argument');
}
if (!file) fail('usage: backup-decrypt.mjs [--key-file F] [--verify] <file.enc>', 2);
const rawKey = keyFile ? readFileSync(keyFile, 'utf8') : process.env.BACKUP_ENCRYPTION_KEY;
const key = parseKey(rawKey);
if (!key) fail('encryption key missing/invalid: set BACKUP_ENCRYPTION_KEY (64 hex chars or base64 of 32 bytes) or use --key-file', 2);

const dec = new Decrypt(key);
dec.verifyOnly = verifyOnly;
try {
  if (verifyOnly) {
    await pipeline(createReadStream(file), dec, async (src) => { for await (const _ of src) { /* drain */ } });
    process.stderr.write('backup-decrypt: OK - every frame authenticated\n');
  } else {
    await pipeline(createReadStream(file), dec, process.stdout);
  }
} catch (err) {
  fail(err.message);
}
