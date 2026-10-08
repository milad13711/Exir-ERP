// Real Nest DI boot check (vitest/esbuild does not emit decorator metadata, so DI errors only show up with real tsc output).
// Run via scripts/di-boot-check.sh — it compiles src with tsc into .di-check/ and runs this file from there with the
// Prisma services stubbed (no database needed). It also exercises the HTTP pipeline: security headers, global rate-limit
// guard (429), alg:none rejection, body-size caps.
import 'reflect-metadata';
process.env.JWT_SECRET = 'x'.repeat(40);
process.env.CONTROL_DATABASE_URL = 'postgresql://u:p@127.0.0.1:1/none';
process.env.NODE_ENV = 'test';
const { Test } = await import('@nestjs/testing');
const { AppModule } = await import('./app.module.js');
const { ControlPrismaService } = await import('./prisma/control-prisma.service.js');
const { TenantPrismaService } = await import('./prisma/tenant-prisma.service.js');
const { RateLimitGuard } = await import('./security/rate-limit.guard.js');
const { SecurityEventsService } = await import('./security/security-events.service.js');
const { SessionEpochService } = await import('./security/session-epoch.service.js');
const { JwtAuthGuard } = await import('./common/guards/jwt-auth.guard.js');
const { AdminJwtAuthGuard } = await import('./common/guards/admin-jwt-auth.guard.js');
const { AdminAuthService } = await import('./admin/admin-auth.service.js');
const { AuthService } = await import('./auth/auth.service.js');
const { TenantTwoFactorService } = await import('./auth/tenant-two-factor.service.js');
const { AdminSecurityController } = await import('./admin/admin-security.controller.js');
const { SuperAdminGuard } = await import('./common/guards/super-admin.guard.js');
const { CspReportController } = await import('./security/csp-report.controller.js');
const { AllExceptionsFilter } = await import('./common/filters/all-exceptions.filter.js');
const { PaymentGatewaySettingsService } = await import('./payment-gateway/payment-gateway-settings.service.js');
const { APP_GUARD } = await import('@nestjs/core');

const model = new Proxy({}, { get: (_t, m) => (m === 'count' ? () => Promise.resolve(0) : m === 'aggregate' ? () => Promise.resolve({ _sum: { attempts: 0 } }) : m === 'create' ? () => Promise.resolve({}) : () => Promise.resolve([])) });
const stub = new Proxy({}, { get: (_t, p) => (p === 'onModuleInit' || p === 'onModuleDestroy' || p === 'then' ? undefined : model) });
const mod = await Test.createTestingModule({ imports: [AppModule] })
  .overrideProvider(ControlPrismaService).useValue(stub)
  .overrideProvider(TenantPrismaService).useValue(stub)
  .compile();
const get = (t) => mod.get(t, { strict: false });
const resolved = { SecurityEventsService, SessionEpochService, AdminAuthService, AuthService, TenantTwoFactorService, AdminSecurityController, CspReportController, PaymentGatewaySettingsService };
for (const [n, t] of Object.entries(resolved)) { if (!get(t)) throw new Error('unresolved ' + n); console.log('ok', n); }
// guards are instantiated per-use-site by Nest: resolve through a controller that uses them
const ctrl = get(AdminSecurityController); console.log('ok AdminSecurityController (guards AdminJwtAuthGuard+SuperAdminGuard DI)');
// APP_GUARD: RateLimitGuard must be registered
let found = false;
for (const m of mod.container.getModules().values()) for (const p of m.providers.values()) if (p.metatype === RateLimitGuard) found = true;
if (!found) throw new Error('RateLimitGuard not registered as provider');
console.log('ok RateLimitGuard registered');
// --- real HTTP pipeline ---
const { ValidationPipe } = await import('@nestjs/common');
const { securityHeadersMiddleware, publicBodyLimitMiddleware } = await import('./security/headers.js');
const app = mod.createNestApplication();
const { json: expressJson } = await import('express');
app.use('/api/security/csp-report', expressJson({ type: ['application/csp-report', 'application/reports+json', 'application/json'], limit: '16kb' }));
app.useBodyParser('json', { limit: '20mb' }); // explicit, exactly like main.ts (a path-mounted express.json would otherwise make Nest skip its default parser)
app.use(securityHeadersMiddleware);
app.use(publicBodyLimitMiddleware);
app.setGlobalPrefix('api');
app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
await app.listen(0);
const port = app.getHttpServer().address().port;
const base = `http://127.0.0.1:${port}/api`;
const hdr = (ip) => ({ 'content-type': 'application/json', 'x-real-ip': ip });
let r = await fetch(`${base}/auth/otp/request`, { method: 'POST', headers: hdr('203.0.113.7'), body: JSON.stringify({ phone: '09120000001' }) });
console.log('otp request ->', r.status, 'x-frame', r.headers.get('x-frame-options'), 'nosniff', r.headers.get('x-content-type-options'), 'reqid', !!r.headers.get('x-request-id'));
// hammer from one IP (different phones) until 429
let got429 = 0, first429 = -1;
for (let i = 0; i < 40; i++) {
  const rr = await fetch(`${base}/auth/otp/request`, { method: 'POST', headers: hdr('203.0.113.7'), body: JSON.stringify({ phone: '0912000' + String(1000 + i) }) });
  if (rr.status === 429 && first429 < 0) first429 = i;
  if (rr.status === 429) got429++;
}
console.log('IP limit: first 429 at request #', first429 + 2, 'total 429:', got429);
// another IP unaffected
r = await fetch(`${base}/auth/otp/request`, { method: 'POST', headers: hdr('203.0.113.99'), body: JSON.stringify({ phone: '09121111111' }) });
console.log('other IP ->', r.status);
// unauth admin route
r = await fetch(`${base}/admin/security/events`, { headers: hdr('203.0.113.50') });
console.log('admin/security/events without token ->', r.status);
// forged alg:none token
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: 'x', isAdmin: true, team: 'SUPER_ADMIN' })}.`;
r = await fetch(`${base}/admin/security/events`, { headers: { ...hdr('203.0.113.51'), authorization: `Bearer ${none}` } });
console.log('alg:none admin token ->', r.status);
// oversized body on /auth
r = await fetch(`${base}/auth/otp/verify`, { method: 'POST', headers: hdr('203.0.113.52'), body: JSON.stringify({ phone: '09120000001', code: '1234', pad: 'x'.repeat(40000) }) });
console.log('oversized /auth body ->', r.status);
// CSP report collector accepts the browser's report content-type and answers 204
const { json: _unused } = await import('express');
r = await fetch(`${base}/security/csp-report`, { method: 'POST', headers: { 'content-type': 'application/csp-report', 'x-real-ip': '203.0.113.60' }, body: JSON.stringify({ 'csp-report': { 'violated-directive': 'script-src', 'blocked-uri': 'inline', 'document-uri': 'https://x/y?token=1' } }) });
console.log('csp-report ->', r.status);
await app.close();
await mod.close().catch(() => {});
console.log('DI BOOT OK');
process.exit(0);
