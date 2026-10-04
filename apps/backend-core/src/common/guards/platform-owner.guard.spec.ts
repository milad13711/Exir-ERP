import { afterEach, describe, expect, it } from 'vitest';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { PlatformOwnerGuard } from './platform-owner.guard.js';

function ctxFor(ctx: unknown): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => ({ ctx }) }) } as unknown as ExecutionContext;
}
const mk = (slug: string, role: string, type = 'tenant_user') => ({ tenantSlug: slug, auth: { type, role } });

describe('PlatformOwnerGuard', () => {
  const guard = new PlatformOwnerGuard();
  afterEach(() => {
    delete process.env.PLATFORM_TENANT_SLUG;
  });

  it('allows OWNER and ADMIN of the parent tenant (default slug eta)', () => {
    expect(guard.canActivate(ctxFor(mk('eta', 'OWNER')))).toBe(true);
    expect(guard.canActivate(ctxFor(mk('eta', 'ADMIN')))).toBe(true);
  });
  it('denies another tenant even as OWNER', () => {
    expect(() => guard.canActivate(ctxFor(mk('acme', 'OWNER')))).toThrow(ForbiddenException);
  });
  it('denies a MEMBER of the parent tenant', () => {
    expect(() => guard.canActivate(ctxFor(mk('eta', 'MEMBER')))).toThrow(ForbiddenException);
  });
  it('denies API keys of the parent tenant', () => {
    expect(() => guard.canActivate(ctxFor(mk('eta', 'OWNER', 'api_key')))).toThrow(ForbiddenException);
  });
  it('denies when no auth context is present', () => {
    expect(() => guard.canActivate(ctxFor(undefined))).toThrow(ForbiddenException);
  });
  it('honors PLATFORM_TENANT_SLUG', () => {
    process.env.PLATFORM_TENANT_SLUG = 'mother';
    expect(guard.canActivate(ctxFor(mk('mother', 'ADMIN')))).toBe(true);
    expect(() => guard.canActivate(ctxFor(mk('eta', 'OWNER')))).toThrow(ForbiddenException);
  });
});
