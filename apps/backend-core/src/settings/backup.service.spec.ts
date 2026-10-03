import { describe, expect, it } from 'vitest';
import { buildPgDumpInvocation } from './backup.service.js';

describe('buildPgDumpInvocation', () => {
  const conn = { dbHost: 'postgres', dbPort: 5432, dbName: 'exir_tenant_abc' };

  it('passes the password via PGPASSWORD, never on the command line', () => {
    const { args, env } = buildPgDumpInvocation(conn, { TENANT_DB_ADMIN_USER: 'admin', TENANT_DB_ADMIN_PASSWORD: 's3cr@t:/pw' });
    expect(args.join(' ')).not.toContain('s3cr@t');
    expect(env.PGPASSWORD).toBe('s3cr@t:/pw');
    expect(args).toEqual(expect.arrayContaining(['--username', 'admin', '--dbname', 'exir_tenant_abc', '--host', 'postgres', '--port', '5432']));
  });

  it('produces a restorable plain dump (clean + if-exists, no ownership/privileges)', () => {
    const { args } = buildPgDumpInvocation(conn, {});
    expect(args).toEqual(expect.arrayContaining(['--no-owner', '--no-privileges', '--clean', '--if-exists']));
    expect(args).toEqual(expect.arrayContaining(['--username', 'postgres']));
  });

  it('does not set PGPASSWORD when no password is configured (local trust auth)', () => {
    const { env } = buildPgDumpInvocation(conn, {});
    expect(env.PGPASSWORD).toBeUndefined();
  });
});
