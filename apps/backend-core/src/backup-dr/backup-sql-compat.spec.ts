import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { describe, expect, it } from 'vitest';
import { SqlCompatTransform, stripIncompatibleHeaderLines } from './backup-sql-compat.js';

async function run(chunks: string[]): Promise<string> {
  const out: Buffer[] = [];
  await pipeline(Readable.from(chunks.map((c) => Buffer.from(c))), new SqlCompatTransform(), async function* (src: AsyncIterable<Buffer>) {
    for await (const c of src) out.push(c);
  });
  return Buffer.concat(out).toString('utf8');
}

describe('SqlCompatTransform', () => {
  const header = '-- PostgreSQL database dump\nSET statement_timeout = 0;\nSET transaction_timeout = 0;\nSET client_encoding = \'UTF8\';\n';

  it('drops SET transaction_timeout from the header and keeps everything else', async () => {
    const out = await run([header, 'COPY t (a) FROM stdin;\n1\n\\.\n']);
    expect(out).not.toContain('transaction_timeout');
    expect(out).toContain('SET statement_timeout = 0;');
    expect(out).toContain("SET client_encoding = 'UTF8';");
    expect(out).toContain('COPY t (a) FROM stdin;\n1\n\\.\n');
  });

  it('works when the header is split across tiny chunks', async () => {
    const chunks = header.split('').concat(['COPY x FROM stdin;\n', 'a\n']);
    expect(await run(chunks)).not.toContain('transaction_timeout');
  });

  it('never alters table data after the header window, even if a row looks like the pattern', async () => {
    const filler = 'x'.repeat(70 * 1024) + '\n';
    const data = 'SET transaction_timeout = 0; (this is user data)\n';
    const out = await run([header, filler, data]);
    expect(out).toContain(data);
    expect(out.indexOf('SET transaction_timeout = 0;\nSET')).toBe(-1);
  });

  it('handles a short stream (shorter than the header window)', async () => {
    expect(await run(['SET transaction_timeout = 0;\nSELECT 1;\n'])).toBe('SELECT 1;\n');
  });

  it('pure helper', () => {
    expect(stripIncompatibleHeaderLines('a\nSET transaction_timeout = 0;\nb')).toBe('a\nb');
  });
});
